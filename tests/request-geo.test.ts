import assert from "node:assert/strict";
import test from "node:test";

import { pickClientIp, readCoarseRequestGeo, readGeoFromMeta, readRequestGeo } from "../lib/requestGeo";

test("readRequestGeo prefers Cloudflare geo headers and coarse location labels", () => {
  const headers = new Headers({
    "cf-connecting-ip": "203.0.113.42",
    "cf-ipcity": "New York",
    "cf-region": "NY",
    "cf-ipcountry": "US",
    "cf-iplatitude": "40.7128",
    "cf-iplongitude": "-74.0060",
  });

  const geo = readRequestGeo(headers);
  assert.deepEqual(geo, {
    city: "New York",
    region: "NY",
    country: "US",
    latitude: "40.7128",
    longitude: "-74.0060",
    ip: "203.0.113.42",
    label: "New York, NY, US · 40.7128, -74.0060",
  });

  const coarse = readCoarseRequestGeo(headers);
  assert.equal(coarse.country, "US");
  assert.equal(coarse.region, "NY");
  assert.equal(coarse.label, "New York, NY, US · 40.7128, -74.0060");
});

test("readRequestGeo falls back to alternate provider headers", () => {
  const headers = new Headers({
    "x-forwarded-for": "198.51.100.24, 10.0.0.1",
    "x-vercel-ip-country": "CA",
    "x-vercel-ip-country-region": "ON",
    "x-vercel-ip-city": "Toronto",
  });

  assert.equal(pickClientIp(headers), "198.51.100.24");

  const geo = readRequestGeo(headers);
  assert.equal(geo.country, "CA");
  assert.equal(geo.region, "ON");
  assert.equal(geo.city, "Toronto");
  assert.equal(geo.label, "Toronto, ON, CA");
});

test("readGeoFromMeta normalizes audit log geo payloads", () => {
  const geo = readGeoFromMeta({
    geoCountry: "US",
    geoRegion: "GA",
    geoCity: "Atlanta",
  });

  assert.equal(geo.country, "US");
  assert.equal(geo.region, "GA");
  assert.equal(geo.city, "Atlanta");
  assert.equal(geo.label, "Atlanta, GA, US");
});
