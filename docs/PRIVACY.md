# Privacy and data handling

## At runtime

The addon reads the CSV selected by the user and sends parsed activities only
to the local Wealthfolio host. It does not log, upload, or transmit the source
statement to this repository or a third-party service.

Instrument mapping uses Wealthfolio's host market-data search. The user reviews
and confirms the resulting identity before import.

## In this repository

Public fixtures are deliberately synthetic. They preserve schema and edge cases
without representing a real account, portfolio, balance, or transaction
history.

Real statements and reviewed acceptance baselines are local-only files. They
are ignored by Git, are supplied through environment variables, and are not
committed, logged, attached to CI, or included in releases.

## In a release ZIP

A release contains the manifest, this user-facing README, and the runtime asset
closure required by the addon. It does not contain real statements, local
baselines, test output, source-control metadata, or development credentials.

## Repository checks

The privacy gate checks tracked text, CSV fixtures, documentation, manifests,
release files, archive contents, Git refs/history, and unreachable Git objects.
It reports filenames and rule names without printing matching sensitive text.

Please report a suspected privacy issue privately to the repository owner rather
than opening an issue with the affected data.
