import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  loadMappings,
  mapDirectValue,
  mapTextValue,
  normalizePath,
  parseMappingUrl,
} from "../scripts/migrateCloudinaryReferences.js";

const publicId = "fh-general-equipments/banners/sample-asset";
const secureUrl = `https://res.cloudinary.com/qmw1959p/image/upload/v1794056085/${publicId}.svg`;

function createMapping(overrides = {}) {
  return {
    "banners/source.svg": {
      originalPath: "/uploads/banners/source.svg",
      publicId,
      secureUrl,
      format: "svg",
      bytes: 257,
      status: "uploaded",
      ...overrides,
    },
  };
}

function withMapping(mapping, callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cloudinary-mapping-test-"));
  const filename = path.join(directory, "mapping.json");
  fs.writeFileSync(filename, JSON.stringify(mapping));
  try {
    callback(filename);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test("loads originalPath as normalized key and accepts actual Cloudinary URL structure", () => {
  withMapping(createMapping(), (filename) => {
    const mappings = loadMappings(filename);
    assert.equal(mappings.size, 1);
    assert.equal(mappings.get("uploads/banners/source.svg").public_id, publicId);
    assert.equal(normalizePath("https://fhgeneralequipment.com/uploads/banners/source.svg"),
      "uploads/banners/source.svg");
    assert.equal(parseMappingUrl(createMapping()["banners/source.svg"]).format, "svg");
  });
});

test("requires uploaded status and matching public IDs", () => {
  withMapping(createMapping({ status: "failed" }), (filename) => {
    assert.throws(() => loadMappings(filename), /not uploaded/);
  });
  withMapping(createMapping({ publicId: `${publicId}-other` }), (filename) => {
    assert.throws(() => loadMappings(filename), /does not match/);
  });
});

test("rejects Cloudinary URLs for another cloud or hostname", () => {
  withMapping(createMapping({
    secureUrl: `https://res.cloudinary.com/other-cloud/image/upload/v123/${publicId}.svg`,
  }), (filename) => {
    assert.throws(() => loadMappings(filename), /qmw1959p/);
  });
  withMapping(createMapping({
    secureUrl: `https://qmw1959p.res.cloudinary.com/image/upload/v123/${publicId}.svg`,
  }), (filename) => {
    assert.throws(() => loadMappings(filename), /res.cloudinary.com hostname/);
  });
});

test("maps both relative and absolute legacy references in fields and text", () => {
  withMapping(createMapping(), (filename) => {
    const mappings = loadMappings(filename);
    const missing = new Set();
    assert.equal(
      mapDirectValue("/uploads/banners/source.svg", mappings, missing),
      secureUrl
    );
    assert.equal(
      mapDirectValue("https://fhgeneralequipment.com/uploads/banners/source.svg", mappings, missing),
      secureUrl
    );
    assert.equal(
      mapTextValue(
        '<img src="https://fhgeneralequipment.com/uploads/banners/source.svg">',
        mappings,
        missing
      ),
      `<img src="${secureUrl}">`
    );
    assert.equal(missing.size, 0);
  });
});
