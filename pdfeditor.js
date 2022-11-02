const fs = require("fs");
const path = require("path");
const opentype = require("opentype.js");
const {
  PDFDocument,
  PDFObject,
  PDFPage,
  PDFPageTree,
  PDFPageLeaf,
  PDFName,
  PDFDict,
  PDFArray,
  PDFContentStream,
  PDFFont,
  PDFImage,
  PDFTextField,
  PDFRawStream,
  StandardFonts,
  rgb,
  degrees,
  PDFNumber,
  asPDFName,
  asPDFNumber,
  PDFRef,

  PDFParser,
  ParseSpeeds,
  assertIs,
  toUint8Array,
  PDFContext,
} = require("pdf-lib");
const { exit } = require("process");

/**
 * Constructor for PDFEditor class
 * @param {String} inputFilePath
 * @param {String} outputFilePath
 * @param {Object} options
 * @returns {PDFEditor}
 */

async function NewPDFEditor(inputFilePath, outputFilePath, options = {}) {
  const {
    ignoreEncryption = false,
    parseSpeed = ParseSpeeds.Slow,
    throwOnInvalidObject = false,
    updateMetadata = true,
    capNumbers = false,
  } = options;

  const pdf = fs.readFileSync(inputFilePath);
  assertIs(pdf, "pdf", ["string", Uint8Array, ArrayBuffer]);
  assertIs(ignoreEncryption, "ignoreEncryption", ["boolean"]);
  assertIs(parseSpeed, "parseSpeed", ["number"]);
  assertIs(throwOnInvalidObject, "throwOnInvalidObject", ["boolean"]);

  const bytes = toUint8Array(pdf);
  const context = await PDFParser.forBytesWithOptions(
    bytes,
    parseSpeed,
    throwOnInvalidObject,
    capNumbers
  ).parseDocument();

  return new PDFEditor(
    inputFilePath,
    outputFilePath,
    context,
    ignoreEncryption,
    updateMetadata
  );
}

/**
 * PDFEditor
 */

class PDFEditor extends PDFDocument {
  /**
   * @param {String} inputFilePath
   * @param {String} outputFilePath
   * @param {PDFContext} context
   * @param {Boolean} ignoreEncryption
   * @param {Boolean} updateMetadata
   */
  constructor(
    inputFilePath,
    outputFilePath,
    context,
    ignoreEncryption,
    updateMetadata
  ) {
    super(context, ignoreEncryption, updateMetadata);
    this.inputFilePath = inputFilePath;
    this.outputFilePath = outputFilePath;
  }

  /**
   * Swaps objects key -> value
   * @param {Object} o
   * @returns
   */
  swapObjKeys(o) {
    return Object.keys(o)
      .reverse()
      .map((k) => ({ [o[k]]: k }))
      .reduce((a, b) => ({ ...a, ...b }));
  }

  /**
   * creates bytes stream
   * from a hex string
   * @param {String} str
   * @param {Number} charsz
   * @returns {Uint8Array}
   */
  parseHexString(str, charsz = 2) {
    var result = [];
    while (str.length >= charsz) {
      result.push(parseInt(str.substring(0, charsz), 16));
      str = str.substring(charsz, str.length);
    }
    return new Uint8Array(result);
  }

  /**
   * decodes hexadecimal string
   * @param {String} str
   * @param {Object.<Number>} cmap
   * @param {Number} charsz
   * @returns {String} src string
   */
  decodeHex(str, cmap, charsz = 2) {
    return Array.from(this.parseHexString(str, charsz))
      .filter((rune) => rune !== 0)
      .map((rune) => String.fromCharCode(cmap[rune.toString()]))
      .join("");
  }

  /**
   * encodes a hexadecimal string
   * @param {String} str
   * @param {Object.<Number>} cmap
   * @param {Number} charsz
   * @returns {String} hex string
   */
  encodeHex(str, cmap, charsz = 2) {
    let output = "";
    let utf8Encode = new TextEncoder();
    for (let rune of utf8Encode.encode(str)) {
      for (let glyphIdx in cmap) {
        let charCode = parseInt(cmap[glyphIdx]);
        let glyphIdxHexStr = parseInt(glyphIdx).toString(16);
        if (charCode === parseInt(rune)) {
          output +=
            Array(Math.max(0, charsz - glyphIdxHexStr.length))
              .fill("0")
              .join("") + glyphIdxHexStr;
          break;
        }
      }
    }
    return output;
  }

  /**
   * creates mapping of
   * glyph index to uncode
   * with additional metrics
   * @param {String} fontPath
   * @param {Number} glyphIdxStart
   * @param {Number} glyphIdxEnd
   * @returns {Object.<Object>} charset
   */
  async parseFontMetrics(fontPath, glyphIdxStart, glyphIdxEnd) {
    const emAdjustmentFactor = 2.048;
    return new Promise((a, r) =>
      opentype.load(fontPath, function (err, font) {
        if (err) {
          r(new Error("Font could not be loaded: " + err));
        } else {
          let characterSet = {};
          for (let i = glyphIdxStart; i < glyphIdxEnd; i++) {
            let glyph = font.glyphs.get(i);
            characterSet[glyph.index] = {
              name: String.fromCodePoint(glyph.index),
              path: glyph.path,
              metrics: glyph.getMetrics(),
              unicode: glyph.unicode,
              width: Math.round(glyph.advanceWidth / emAdjustmentFactor),
            };
          }
          return a(characterSet);
        }
      })
    );
  }

  /**
   * finds PDFObject by
   * objectNumber or null
   * @param {Number} objNum
   * @returns {PDFObject|null}
   */
  getIndirectObjectByNumber(objNum) {
    for (let m of this.context.enumerateIndirectObjects()) {
      let ref = m[0];
      let dict = m[1];
      if (ref.objectNumber === objNum) return dict;
    }
    return null;
  }

  /**
   * finds PDFObject by key-value
   * of PDF object dict and matches
   * the generic object type
   * @param {String} typeKey
   * @param {String} typeName
   * @param {Object} type
   * @returns {PDFObject|null}
   */
  getIndirectObjectByTypeKey(typeKey, typeName, type = null) {
    let matchedTypes = [];
    for (let m of this.context.enumerateIndirectObjects()) {
      if (!!!typeName && !!!type) {
        matchedTypes.push(m[1]);
        continue;
      }

      if (!!type && m[1] instanceof type) {
        matchedTypes.push(m[1]);
        continue;
      }

      for (let subObj of m[1].array || [m[1].dict]) {
        if (!!type && subObj instanceof type) {
          matchedTypes.push(subObj);
          continue;
        }

        if (subObj instanceof Map) {
          let disassembledSubObj = Object.fromEntries(subObj);
          if (disassembledSubObj[typeKey]?.toString() === typeName) {
            matchedTypes.push(subObj);
          }
        }
      }
    }
    return matchedTypes;
  }

  /**
   * Only finds PDFObject
   * matched by keys only
   * or a generic type instance
   * @param {String} typeName
   * @param {Object} type
   * @returns {PDFObject|null}
   */
  getIndirectObjectsByType(typeName, type = null) {
    return this.getIndirectObjectByTypeKey("/Type", typeName, type);
  }

  /**
   * Removes any object matching
   * nested /Name or ObjectNumber
   * from the given PDFPage Object
   * @param {PDFPage} page
   * @param {Array.<String|Number>} objectsList
   * @returns {Array.<PDFObject>} thats been removed
   */
  removeObjectsByNameOrNumber(page, objectsList) {
    const removed = [];
    for (let objectId of objectsList) {
      let matchedObjs;
      if (typeof objectId === "string") {
        matchedObjs = this.getIndirectObjectByTypeKey("/Name", objectId, null);
        if (matchedObjs.length < 1) {
          for (let pageNode of page.node.dict) {
            if (pageNode[1].dict) {
              for (let resObj of pageNode[1]?.dict || []) {
                for (let val of resObj[1]?.dict || []) {
                  if (
                    val[0].toString() === objectId &&
                    val[1] instanceof PDFRef
                  ) {
                    matchedObjs.push(
                      this.getIndirectObjectByNumber(val[1].objectNumber)
                    );
                  }
                }
              }
            } else if (pageNode[1].array) {
              for (let val of pageNode[1].array) {
                if (val instanceof PDFRef) {
                  let indirectObj = this.getIndirectObjectByNumber(
                    val.objectNumber
                  );
                  if (indirectObj.dict) {
                    for (let subIndirectObj of indirectObj.dict || []) {
                      if (subIndirectObj[0].toString() === objectId) {
                        matchedObjs.push(subIndirectObj[1]);
                      }
                    }
                  }
                }
              }
            }
          }
        }
      } else if (typeof objectId === "number")
        matchedObjs = [this.getIndirectObjectByNumber(objectId)];
      else continue;

      for (let selectedObj of matchedObjs) {
        if (selectedObj.contents) {
          selectedObj.contents = Buffer.from("");
        } else if (selectedObj.dict) {
          selectedObj.dict = new Map();
        } else if (selectedObj.array) {
          selectedObj.array = new PDFArray();
        }
        removed.push(selectedObj);
      }
    }
    return removed;
  }

  /**
   * extracts texts from contents obj
   * based on fonts metrics provided
   * assumes encoding as Indentity-H
   * @param {PDFRawStream} contentsObj
   * @param {{Object.<Object>}} fontMetrics
   * @returns {Object}
   */
  extractText(contentsObj, fontMetrics) {
    const matchHexTj = (haystack) => {
      const bucket = [];
      const regex = /<([\w]+)>\s+Tj/gm;
      // Alternative syntax using RegExp constructor
      // const regex = new RegExp('<([\\w]+)>\\s+Tj', 'gm')
      let m;
      while ((m = regex.exec(haystack)) !== null) {
        // This is necessary to avoid infinite loops with zero-width matches
        if (m.index === regex.lastIndex) {
          regex.lastIndex++;
        }
        bucket.push(m.slice(1));
      }
      return bucket.flat();
    };

    let contentsStreamDecoded = contentsObj.toString("utf8");
    const cmap = Object.keys(fontMetrics)
      .map((c) => ({
        [c]: fontMetrics[c].unicode,
      }))
      .reduce((a, b) => ({ ...a, ...b }));

    let hexDecodedTjStrings = matchHexTj(contentsStreamDecoded).map((s) => ({
      sourceHexString: s,
      decodedString: this.decodeHex(s, cmap, 4),
    }));

    return {
      cmap,
      hexDecodedTjStrings,
      contentsStreamDecoded,
    };
  }

  /**
   * Replaces texts in content stream
   * @param {PDFRawStream} contentObj
   * @param {{Object.<Object>}} fontMetrics
   * @param {Object} replacements
   * @returns {PDFRawStream}
   */
  replaceTexts(contentsObj, fontMetrics, replacements) {
    let { cmap, hexDecodedTjStrings, contentsStreamDecoded } = this.extractText(
      contentsObj,
      fontMetrics
    );

    for (let key in replacements) {
      let value = replacements[key];
      // raw strings replacements
      contentsStreamDecoded = contentsStreamDecoded.replaceAll(key, value);

      // replacing hex encoded string
      // (Indentity-H)
      for (let swapMapping of hexDecodedTjStrings) {
        let { sourceHexString, decodedString } = swapMapping;
        decodedString = decodedString.replaceAll(key, value);
        let reEncodedHexString = this.encodeHex(decodedString, cmap, 4);

        if (sourceHexString.toLowerCase() != reEncodedHexString.toLowerCase()) {
          contentsStreamDecoded = contentsStreamDecoded.replaceAll(
            sourceHexString,
            reEncodedHexString
          );
        }
      }
    }

    // finally updating the content stream
    return {
      cmap,
      hexDecodedTjStrings,
      contentsStreamDecoded,
      newContentsObj: (contentsObj.contents = Buffer.from(
        contentsStreamDecoded
      )),
    };
  }

  /**
   * Modifies PDFDocument and renders
   * @param {Object[]}  options
   * @param {Number} options.pageNumber
   * @param {Number} options.fontIdx
   * @param {String} options.font
   * @param {Object} options.textReplacements
   * @param {Array.<Number|String>} options.removeObjects
   * @param {Array.<String>} options.plugins
   * @returns {Array.<String>} warnings
   */
  async modifyPDF(
    options // options for procedings
  ) {
    let warnings = [];

    /**
     * Paging
     */
    for (let option of options) {
      let {
        pageNumber,
        fontIdx,
        font,
        textReplacements,
        removeObjects,
        plugins,
      } = option;

      // more precise
      let fontPath = path.join(
        __dirname,
        "res",
        "fonts",
        encodeURIComponent(font)
      );

      // Page validation
      let totalPages = this.getPageCount();
      if (pageNumber >= totalPages) {
        warnings.push(
          new Error(
            `cannot index page ${pageNumber}/${totalPages} in file: ${inputFilePath}: no such page`
          )
        );
        continue;
      }

      /**
       * Page
       */
      const page = this.getPage(pageNumber);

      /**
       * Removing Objects
       */

      this.removeObjectsByNameOrNumber(page, removeObjects);

      /**
       * Font metrics
       */

      let fontMetrics;
      try {
        fontMetrics = await this.parseFontMetrics(fontPath, 0, 256);
      } catch (e) {
        warnings.push(`err parsing font metrics: ${e.message}`);
        continue;
      }

      /**
       * Replacing Text
       */
      let textComponents;
      try {
        const pageContent = this.getIndirectObjectByNumber(
          page.node.get(PDFName.of("Contents")).objectNumber
        );
        textComponents = this.replaceTexts(
          pageContent,
          fontMetrics,
          textReplacements
        );
      } catch (e) {
        warnings.push(`err replacing text: ${e.message}`);
      }

      /**
       * Plugins
       */
      for (let pluginName of plugins) {
        let pluginsObj = this.plugins();
        if (pluginName in pluginsObj) {
          try {
            pluginsObj[pluginName](options, textComponents);
          } catch (e) {
            warnings.push(`err <Plugin ${pluginName}>: ${e.message}`);
          }
        }
      }

      /**
       * Replacing Font File
       * and Font Widths
       */
      let fontObj;
      try {
        fontObj = Object.fromEntries(
          this.getIndirectObjectsByType("/Font")[fontIdx]
        );
      } catch (e) {
        warnings.push(
          new Error(`cannot index ${fontIdx} in font resources: ` + e.message)
        );
        continue;
      }

      // gets the last /DescendantFonts
      let fontDescendantObj;
      try {
        fontDescendantObj = this.getIndirectObjectByNumber(
          fontObj["/DescendantFonts"].array[
            fontObj["/DescendantFonts"].array.length - 1
          ].objectNumber
        );
      } catch (e) {
        warnings.push(
          new Error(`none of the decendant fonts found: ` + e.message)
        );
        continue;
      }

      // assigning font width operator
      let fontWidthOperator;
      for (let key of fontDescendantObj.keys()) {
        if (key.toString() === "/W") {
          fontWidthOperator = fontDescendantObj.get(key);
          break;
        }
      }

      // Character to Fonts Widths Mapping
      if (fontWidthOperator) {
        for (let glyphIdx in fontMetrics) {
          let glyph = fontMetrics[glyphIdx];
          let mappingPdfArray = new PDFArray(fontWidthOperator.context);
          if (glyph.width) {
            mappingPdfArray.push(asPDFNumber(glyph.width));
            fontWidthOperator.push(asPDFNumber(glyphIdx));
            fontWidthOperator.push(mappingPdfArray);
          }
        }
      }

      try {
        // Digging FontDescriptor
        const fontDescriptor = this.getIndirectObjectByNumber(
          Object.fromEntries(fontDescendantObj.dict)["/FontDescriptor"]
            .objectNumber
        );

        // Replacing FontFile
        const fontFileObj = this.getIndirectObjectByNumber(
          Object.fromEntries(fontDescriptor.dict)["/FontFile2"].objectNumber
        );
        fontFileObj.contents = fs.readFileSync(fontPath);
      } catch (e) {
        warnings.push(
          new Error(`cannot address /FontDescriptor: ` + e.message)
        );
      }
    }

    /**
     * Rendering out the document
     */
    await this.render();

    // Returning the list of warnings
    // Fatal errors are thrown
    return warnings;
  }

  async render() {
    // Serialize the PDFDocument to bytes (a Uint8Array)
    const pdfBytes = await this.save();
    return fs.writeFileSync(this.outputFilePath, pdfBytes);
  }

  /**
   * returns plugins methods
   * @returns {Object}
   */
  plugins() {
    return {
      xbmu: (options, textComponents) => {
        let xTjStrs = textComponents?.hexDecodedTjStrings;
        if (xTjStrs && xTjStrs?.length && xTjStrs.length >= 17) {
          let newFilename = `${xTjStrs[10].decodedString}-${
            xTjStrs[12].decodedString
          }-${xTjStrs[14].decodedString}_${
            xTjStrs[4].decodedString
          }_${xTjStrs[0].decodedString.replaceAll(" ", "_")}.pdf`;
          if (newFilename.includes("/") || newFilename.includes("\\")) {
            throw new Error(
              "ValueError: filename contains path sep: " + newFilename
            );
          } else {
            let newOutputFilePath = this.outputFilePath.replaceAll(
              path.basename(this.outputFilePath),
              newFilename
            );
            this.outputFilePath = newOutputFilePath;
          }
        }
      },
    };
  }
}

module.exports = { NewPDFEditor };
