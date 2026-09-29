# Final quality review — beta29

Final verification found duplicate default browser guidance in the request preamble. SYSTEM_PROMPT already defines the copilot workflow; automatic browser-agent selection no longer repeats its entire instruction block. Explicit built-in and custom skills still retain all instructions. The document browser test keeps its existing 30,000-character ceiling and checks original facts are retrieved rather than injected up front.

This follows [Anthropic context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents): preserve high-signal guidance and retrieve reference material when needed. No new runtime library was needed for deduplication. Existing Pi, MiniSearch and document readers remain in use. This is a context-size and regression result, not a measured improvement in live-model reasoning.

The complete current release evidence is in [RELEASE-BETA29.md](RELEASE-BETA29.md). Initial failure is retained alongside the subsequent full pass. The source export includes the paired OpenWiki question endpoint and MiniSearch dependency needed by the existing integration fixtures. Dormant A2A files are not exported or bundled.
