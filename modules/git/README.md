# git module

Native `git` endpoint. It runs commands with bounded concurrency, captures raw
stdout and stderr, and supports cancellation and timeouts. Parsing remains
outside the process runner.

