# Meridian releases and provenance

## Version control history

Development from 0.3.1 (commit `1fb3f36`) to 0.10.0 was not committed as it happened. Intermediate versions have no history and none was reconstructed. Commits and tags carry their true creation date, which is after deployment.

## 0.10.0

| | |
| --- | --- |
| Tag | `v0.10.0` (annotated, tag object `e6bbe42cdaf48514195800a12cd817f776a3a503`) |
| Baseline commit | `6ba5a90cb9e7573ab87261196d85ac4218b932b9`, created 2026-11-09 after deployment |
| Deployed image | `sha256:4953787a19066087421fa03b8db646f270d3d73779fc7ad519472dd5524de171` |
| Image config | `sha256:de536fee06f5cdd07d8a38d5245f1d27a2dab356e1183685177d0424f6cf84e9` |
| Image built | 2026-11-09T09:54:03.300207038Z |
| Deployed | Exodus, 2026-11-09. The running container's image was read back on 2026-11-09 and matches the digest above |

### What has been demonstrated

Checked on 2026-11-09 from a clean clone of the tagged commit, against the image archive saved at release time.

- Of 34 non-compiled files in the image's `/app`, 12 are byte-identical to the tag and 21 differ only in line endings, and 1 differs as described below.
- The image was rebuilt with `deploy/Dockerfile`. Every file outside `/app` that is not a compiled `.pyc` is identical. Entrypoint, environment and user are the same.
- The unit suite passes on the clone: 187 passed.

### What has not been demonstrated

The build is **not reproducible to the digest**. Two rebuilds gave two different digests, sharing 7 of 11 layers with the deployed image.

- `backend/meridian/store.py` differs by one docstring line, where a personal-looking example name was replaced with a fictional one. Its commit message calls this a comment; it is a docstring. Behaviour does not depend on it.
- The deployed image was built from a Windows working tree, so 21 text files have CRLF line endings there and LF here.
- The deployed image holds 16 extra `.pyc` files under `/app`, copied from local test runs because `.dockerignore` does not exclude `__pycache__`. A clean checkout has none.
- The commit was made after the image was built. It records matching content, not the build's actual input.

### Material held back

26 screenshots under `docs/screenshots/` remain local and untracked because they show a personal-looking example name. `README.md` still refers to `docs/screenshots/0.5.0/`, so that link is empty in a clean clone. The commit after the baseline adapts one test query to the fictional name.

## Conventions

Create the tag before deploying and build from a clean checkout of it. Record the commit and image digest in the deployment record. Do not move a published tag.
