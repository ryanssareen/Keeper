declare module "tz-lookup" {
  /** Returns the IANA time-zone name for a coordinate, e.g. tzlookup(41.40, 2.17) === "Europe/Madrid". */
  export default function tzlookup(lat: number, lon: number): string;
}
