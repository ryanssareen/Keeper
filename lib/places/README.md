# Places dataset

`airports.json` is a vendored, filtered snapshot of the OpenFlights airport
database (via the `airport-codes` npm package, ISC; underlying data ODbL).

Filtered to entries with a valid 3-letter IATA code and a city + country, with
heliports / seaplane bases / rail & bus stations removed. Shape per entry:

    { "code": "LHR", "city": "London", "country": "United Kingdom", "name": "Heathrow" }

Regenerate by re-running the filter in the PR that introduced this file. Served
to the destination autocomplete through `app/api/places/route.ts`.
