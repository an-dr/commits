# Vendored upstream code

Third-party sources this repository builds against but does not own.

Nothing here is edited. Fixes go upstream and return as a new pinned revision;
local patches would be silently lost at the next update and would make the
pinned revision a lie about what was built. Each entry keeps its own license,
which is not necessarily this repository's.

Adapting upstream to this project is the job of the code that consumes it.
