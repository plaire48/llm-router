from __future__ import annotations

import asyncio
import os

import typer

from llm_router.config import Settings, load_profiles
from llm_router.credentials.anthropic_oauth import TokenStore
from llm_router.credentials.openai_oauth import OpenAIAccountStore
from llm_router.errors import RouterError
from llm_router.http_client import create_async_client
from llm_router.oauth.openai_flow import login as login_openai
from llm_router.opencode_organizations import AI_PRO_ORIGIN
from llm_router.opencode_runtime import OpenCodeRuntime
from llm_router.provider_policy import ANTHROPIC_OAUTH_DISABLED_MESSAGE

app = typer.Typer(help="llm-router: local OpenAI-compatible LLM gateway")
oauth_app = typer.Typer(help="OAuth login")
profiles_app = typer.Typer(help="Profile inspection")
app.add_typer(oauth_app, name="oauth")
app.add_typer(profiles_app, name="profiles")


@app.command()
def serve(
    profiles: str = typer.Option("profiles.yaml", help="Path to profiles.yaml"),
    host: str | None = typer.Option(None, help="Bind host (default: 127.0.0.1)"),
    port: int | None = typer.Option(None, help="Bind port (default: 8787)"),
) -> None:
    try:
        settings = Settings()
        registry = load_profiles(profiles)
    except Exception as exc:
        typer.echo(f"config error: {exc}")
        raise typer.Exit(code=1) from exc

    import uvicorn

    from llm_router.server import create_app
    from llm_router.usage import UsageStore

    settings.host = settings.host if host is None else host
    settings.port = settings.port if port is None else port
    store = UsageStore(settings.usage_db)
    try:
        application = create_app(settings, registry, store=store, profiles_path=profiles)
    except RouterError as exc:
        store.close()
        typer.echo(f"config error: {exc.message}")
        raise typer.Exit(code=1) from exc
    try:
        uvicorn.run(
            application,
            host=settings.host,
            port=settings.port,
        )
    finally:
        store.close()


@oauth_app.command("login")
def oauth_login(provider: str) -> None:
    if provider not in {"openai", "anthropic", "aipro"}:
        typer.echo(f"unsupported provider: {provider}")
        raise typer.Exit(code=1)
    if provider == "anthropic":
        typer.echo(ANTHROPIC_OAUTH_DISABLED_MESSAGE)
        raise typer.Exit(code=1)
    try:
        if provider == "openai":
            asyncio.run(login_openai())
        else:
            settings = Settings()
            runtime = OpenCodeRuntime(
                base_url=settings.opencode_url,
                binary=settings.opencode_binary,
                directory=settings.opencode_directory,
                auto_start=settings.opencode_auto_start,
            )

            async def login_aipro() -> None:
                async with create_async_client(timeout=600.0) as client:
                    try:
                        await runtime.login_organization(client, AI_PRO_ORIGIN)
                    finally:
                        await runtime.close()

            asyncio.run(login_aipro())
    except (RouterError, OSError) as exc:
        detail = exc.message if isinstance(exc, RouterError) else str(exc)
        typer.echo(f"{provider} browser login failed: {detail}")
        raise typer.Exit(code=1) from exc


def _credential_status(provider: str, auth: str, api_key_env: str | None) -> str:
    if auth == "api_key":
        from llm_router.credentials.env_key import load_provider_env

        load_provider_env()
        return "set" if api_key_env and os.environ.get(api_key_env) else "missing"
    if provider == "openai":
        try:
            settings = Settings()
            tokens = OpenAIAccountStore.from_opencode(
                settings.opencode_directory / "data" / "opencode" / "auth.json"
            ).tokens()
            return (
                "logged_in"
                if tokens and OpenAIAccountStore.account_id(tokens)
                else "login_required"
            )
        except RouterError:
            return "invalid_store"
    if provider == "aipro":
        try:
            settings = Settings()
            runtime = OpenCodeRuntime(directory=settings.opencode_directory)
            return (
                "logged_in" if runtime.organization_connected(AI_PRO_ORIGIN) else "login_required"
            )
        except (RouterError, ValueError):
            return "invalid_store"

    try:
        tokens = TokenStore.default().load()
        connected = bool(
            tokens
            and isinstance(tokens.get("access_token"), str)
            and (not TokenStore.default().is_expired(tokens) or tokens.get("refresh_token"))
        )
        return "logged_in" if connected else "login_required"
    except RouterError:
        return "invalid_store"


@profiles_app.command("list")
def profiles_list(
    profiles: str = typer.Option("profiles.yaml", help="Path to profiles.yaml"),
) -> None:
    try:
        registry = load_profiles(profiles)
    except RouterError as exc:
        typer.echo(f"config error: {exc.message}")
        raise typer.Exit(code=1) from exc

    typer.echo("NAME\tPROVIDER\tAUTH\tCREDENTIAL")
    for name in registry.names():
        profile = registry.resolve(name)
        status = _credential_status(profile.provider, profile.auth, profile.api_key_env)
        typer.echo(f"{profile.name}\t{profile.provider}\t{profile.auth}\t{status}")
