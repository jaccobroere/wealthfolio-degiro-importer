# Contributor notes

This is a Wealthfolio 3.6.1 addon for Dutch-locale DEGIRO account-statement
CSV files. The core parser and mapping layers do not import React or the SDK.
Use Node 20.19.0 and pnpm 10.34.5. Public tests use synthetic fixtures only;
local acceptance requires the statement and ignored baseline environment vars.
The ZIP contains only the manifest, README, and bundled runtime closure.
