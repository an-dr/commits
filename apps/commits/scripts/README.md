# Application build scripts

Scripts that produce this application's artifacts: the page bundle, the page
markup, and the WebAssembly components.

A script belongs here when it builds something this application ships. Scripts
that prepare a developer's machine or manage the repository as a whole belong in
the top-level `scripts/`.

Each script targets one artifact so an unchanged part is never rebuilt. Run them
through the `build:*` npm targets rather than directly, so their inputs and
output locations stay declared in one place.
