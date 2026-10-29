# Repository scripts

Native build orchestration belongs to [`cargo xtask`](../xtask/README.md). Application frontend commands remain under `apps/commits/scripts`; Windows installation remains in `install.ps1`, and `ci-docker.sh` owns the Docker invocation.

Scripts that operate on the repository or a developer's machine rather than on one application's artifacts.

A script belongs here when it prepares tooling, removes generated output, or assembles a distribution across applications. A script that builds a specific artifact belongs beside that artifact, under its application.
