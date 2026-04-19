"use strict";

module.exports = {
  name: "bad-apiversion-plugin",
  apiVersion: "2",
  templateRoot: __dirname,
  generate() {
    return { files: [] };
  },
};
