from __future__ import annotations

import os

import typer

from llm_router.config import Settings, load_profiles
from llm_router.errors import RouterError

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
        typer.echo(f"config error (is LLM_ROUTER_MASTER_KEY set?): {exc}")
        raise typer.Exit(code=1) from exc

    import uvicorn

    from llm_router.server import create_app

    application = create_app(settings, registry)
    uvicorn.run(
        application,
        host=settings.host if host is None else host,
        port=settings.port if port is None else port,
    )


@oauth_app.command("login")
def oauth_login(provider: str) -> None:
    if provider == "openai":
        typer.echo("OpenAI subscription OAuth is pending verified discovery.")
        raise typer.Exit(code=1)
    if provider != "anthropic":
        typer.echo(f"unsupported provider: {provider}")
        raise typer.Exit(code=1)

    from llm_router.credentials.anthropic_oauth import TokenStore
    from llm_router.oauth.flow import login

    try:
        login(TokenStore.default())
    except RouterError as exc:
        typer.echo(f"OAuth login failed: {exc.message}")
        raise typer.Exit(code=1) from exc


def _credential_status(provider: str, auth: str, api_key_env: str | None) -> str:
    if auth == "api_key":
        return "set" if api_key_env and os.environ.get(api_key_env) else "missing"
    if provider == "openai":
        return "pending"

    from llm_router.credentials.anthropic_oauth import TokenStore

    try:
        return "logged_in" if TokenStore.default().load() else "login_required"
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
