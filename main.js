require("dotenv").config();
const fs = require("fs");
const url = require("url");
const path = require("path");
const express = require("express");
const multer = require("multer");
const app = express();
const PORT = process.env.PORT || 3000;
const uploader = multer({
  dest: path.join(__dirname, process.env.UPLOAD_DIR || "uploads"),
});

const { NewPDFEditor } = require("./pdfeditor");

/**
 * Static file server
 */
app.use("/", express.static(path.join(__dirname, "public")));

/**
 * PDF Processing Route
 */
app.post(
  "/pdf/proc",
  (req, res, next) => {
    let rawRef = req.headers["referer"];
    if (rawRef) {
      try {
        let ref = url.parse(rawRef);
        let opts = JSON.parse(
          Buffer.from(
            ref.query.replaceAll(/^\??options\=/g, ""),
            "base64"
          ).toString()
        );
        req.opts = opts;
        return next();
      } catch (e) {
        return res.sendStatus(400);
      }
    } else return res.sendStatus(403);
  },
  /**
   * Receives Wildcard* Files
   */
  uploader.any(),
  /**
   * Handling PDF file processing
   */
  async (req, res) => {
    if (req.files.length < 1) {
      return res.status(400).json({
        success: false,
        msg: "POST data contains no file.",
        data: null,
      });
    }

    // variable objs
    let success = true;
    let data = [];
    for (let file of req.files) {
      try {
        /**
         * new PDFEditor instance
         */
        const pdfEditor = await NewPDFEditor(
          file.path,
          // default outputFilePath
          // might get changed by
          // any plugin inside
          // pdfeditor.js
          path.join(__dirname, "public", "bucket", file.filename + ".pdf")
        );

        // modifies pdf and returns warnings/stats
        let stats = await pdfEditor.modifyPDF(req.opts);
        // since modifyPDF func may
        // have plugins so we refetch
        // the outFilePath as it may
        // be changed already
        let outputBasename = path.basename(pdfEditor.outputFilePath);

        /**
         * data[] <- Obj
         */
        data.push({
          name: outputBasename, // new basename
          url: `/${path.join("bucket", outputBasename)}`, // public bucket
          stats, // warnings
        });
      } catch (e) {
        // if data[] === String
        // must be an error
        // frontent must check if
        // data[] is array then all ok
        data.push("err: " + e.message);
      }
    }

    /**
     * generalised API response
     * doesn't alter success as
     * can be multiple files
     * since res.files in for loop
     */
    return res.status(200).json({
      success,
      data,
      msg: "processed",
    });
  }
);

/**
 * server init
 */
app.listen(PORT, () => {
  console.log(`server listening at ${PORT}`);
});
