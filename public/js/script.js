const $ = function (selector, bind) {
  var bind = bind === undefined ? document : bind;
  let nodes = bind.querySelectorAll.bind(bind)(selector);
  return nodes.length == 1 ? nodes[0] : nodes;
};

String.prototype.hexEncode = function () {
  var hex, i;
  var result = "";
  for (i = 0; i < this.length; i++) {
    hex = this.charCodeAt(i).toString(16);
    result += ("000" + hex).slice(-4);
  }
  return result;
};

String.prototype.hexDecode = function () {
  var j;
  var hexes = this.match(/.{1,4}/g) || [];
  var back = "";
  for (j = 0; j < hexes.length; j++) {
    back += String.fromCharCode(parseInt(hexes[j], 16));
  }
  return back;
};

String.prototype.base64Encode = function () {
  return btoa(this);
};

String.prototype.base64Decode = function () {
  return atob(this);
};

class ContentMgr {
  constructor() {
    this.resultEl = document.querySelector("result");
    this.controllerEl = document.querySelector("controller");
    this.controllerEl
      .querySelector("button.download-all")
      .addEventListener("click", () => {
        this.downloadAll();
      });
    this.items = [];
  }

  add(fileAlias, fileUrl) {
    let fileHash = fileUrl.base64Encode();
    if (
      this.resultEl.children.length < 1 ||
      !Array.prototype.some.call(
        this.resultEl.querySelectorAll(".item"),
        (itemEl) => itemEl.getAttribute("hash") === fileHash
      )
    ) {
      if (this.items.length < 1)
        (this.resultEl.style.display = "flex"),
          (this.controllerEl.style.display = "flex");

      let itemEl = document.createElement("div");
      itemEl.className = "item";
      itemEl.href = fileUrl;
      itemEl.setAttribute("hash", fileHash);
      itemEl.onclick = () => this.download(fileUrl, fileAlias, itemEl);
      itemEl.innerHTML = `<img class="pdf-icon" src="img/pdf.png" alt="PDF" /><span
        >${fileAlias}</span></div>`;
      this.resultEl.appendChild(itemEl);
      this.items.push({
        fileHash,
        fileAlias,
        fileUrl,
        itemEl,
      });
    }
    return fileHash;
  }

  remove(fileHash) {
    return !!Array.prototype.map
      .call(this.resultEl.querySelectorAll(".item"), (itemEl) =>
        itemEl.getAttribute("hash") === fileHash
          ? !!itemEl.parentNode.removeChild(itemEl) &&
            (this.items.forEach((item) => {
              if (item.fileHash === fileHash)
                this.items.splice(this.items.indexOf(item), 1);
            }),
            true)
          : null
      )
      .some((b) => !!b)
      ? this.items.length < 1
        ? ((this.resultEl.style.display = "none"),
          (this.controllerEl.style.display = "none"),
          true)
        : true
      : false;
  }

  async download(fileUrl, fileAlias, itemEl) {
    try {
      await download(
        fileUrl
        // fileAlias || "PDF_File_" + new Date().getTime().toString(),
        // "application/pdf"
      );
      itemEl.classList.add("item-downloaded");
      iziToast.show({
        theme: "dark",
        title: "Downloaded",
        message: fileAlias + " ✓",
        position: "topRight",
        backgroundColor: "#1f1f1f",
        progressBarColor: "rgb(0, 255, 184)",
      });
    } catch (e) {
      iziToast.error({ title: "Error", message: e.message });
    }
  }

  async downloadAll() {
    let res = [];
    for (let item of this.items) {
      res.push(await this.download(item.fileUrl, item.fileAlias, item.itemEl));
    }
    return res;
  }
}

(function () {
  window.contentMgr = new ContentMgr();
})();

// set minimum number of lines CodeMirror instance is allowed to have
(function (mod) {
  mod(CodeMirror);
})(function (CodeMirror) {
  var fill = function (cm, start, n) {
    while (start < n) {
      let count = cm.lineCount();
      cm.replaceRange("\n", { line: count - 1 }), start++;
      // remove new line change from history (otherwise user could ctrl+z to remove line)
      let history = cm.getHistory();
      history.done.pop(), history.done.pop();
      cm.setHistory(history);
      if (start == n) break;
    }
  };
  var pushLines = function (cm, selection, n) {
    // push lines to last change so that "undo" doesn't add lines back
    var line = cm.lineCount() - 1;
    var history = cm.getHistory();
    history.done[history.done.length - 2].changes.push({
      from: {
        line: line - n,
        ch: cm.getLine(line - n).length,
        sticky: null,
      },
      text: [""],
      to: { line: line, ch: 0, sticky: null },
    });
    cm.setHistory(history);
    cm.setCursor({ line: selection.start.line, ch: selection.start.ch });
  };

  var keyMap = {
    Backspace: function (cm) {
      var cursor = cm.getCursor();
      var selection = {
        start: cm.getCursor(true),
        end: cm.getCursor(false),
      };

      // selection
      if (selection.start.line !== selection.end.line) {
        let func = function (e) {
          var count = cm.lineCount(); // current number of lines
          var n = cm.options.minLines - count; // lines needed
          if (e.key == "Backspace" || e.code == "Backspace" || e.which == 8) {
            fill(cm, 0, n);
            if (count <= cm.options.minLines) pushLines(cm, selection, n);
          }
          cm.display.wrapper.removeEventListener("keydown", func);
        };
        cm.display.wrapper.addEventListener("keydown", func); // fires after CodeMirror.Pass

        return CodeMirror.Pass;
      } else if (selection.start.ch !== selection.end.ch)
        return CodeMirror.Pass;

      // cursor
      var line = cm.getLine(cursor.line);
      var prev = cm.getLine(cursor.line - 1);
      if (
        cm.lineCount() == cm.options.minLines &&
        prev !== undefined &&
        cursor.ch == 0
      ) {
        if (line.length) {
          // add a line because this line will be attached to previous line per default behaviour
          cm.replaceRange("\n", { line: cm.lineCount() - 1 });
          return CodeMirror.Pass;
        } else cm.setCursor(cursor.line - 1, prev.length); // set cursor at end of previous line
      }
      if (cm.lineCount() > cm.options.minLines || cursor.ch > 0)
        return CodeMirror.Pass;
    },
    Delete: function (cm) {
      var cursor = cm.getCursor();
      var selection = {
        start: cm.getCursor(true),
        end: cm.getCursor(false),
      };

      // selection
      if (selection.start.line !== selection.end.line) {
        let func = function (e) {
          var count = cm.lineCount(); // current number of lines
          var n = cm.options.minLines - count; // lines needed
          if (e.key == "Delete" || e.code == "Delete" || e.which == 46) {
            fill(cm, 0, n);
            if (count <= cm.options.minLines) pushLines(cm, selection, n);
          }
          cm.display.wrapper.removeEventListener("keydown", func);
        };
        cm.display.wrapper.addEventListener("keydown", func); // fires after CodeMirror.Pass

        return CodeMirror.Pass;
      } else if (selection.start.ch !== selection.end.ch)
        return CodeMirror.Pass;

      // cursor
      var line = cm.getLine(cursor.line);
      if (cm.lineCount() == cm.options.minLines) {
        if (
          cursor.ch == 0 &&
          (line.length !== 0 || cursor.line == cm.lineCount() - 1)
        )
          return CodeMirror.Pass;
        if (cursor.ch == line.length && cursor.line + 1 < cm.lineCount()) {
          // add a line because next line will be attached to this line per default behaviour
          cm.replaceRange("\n", { line: cm.lineCount() - 1 });
          return CodeMirror.Pass;
        } else if (cursor.ch > 0) return CodeMirror.Pass;
      } else return CodeMirror.Pass;
    },
  };

  var onCut = function (cm) {
    var selection = {
      start: cm.getCursor(true),
      end: cm.getCursor(false),
    };
    setTimeout(function () {
      // wait until after cut is complete
      var count = cm.lineCount(); // current number of lines
      var n = cm.options.minLines - count; // lines needed
      fill(fm, 0, n);
      if (count <= cm.options.minLines) pushLines(cm, selection, n);
    });
  };

  var start = function (cm) {
    // set minimum number of lines on init
    var count = cm.lineCount(); // current number of lines
    cm.setCursor(count); // set the cursor at the end of existing content
    fill(cm, 0, cm.options.minLines - count);
    cm.addKeyMap(keyMap);

    // bind events
    cm.display.wrapper.addEventListener("cut", onCut, true);
  };
  var end = function (cm) {
    cm.removeKeyMap(keyMap);

    // unbind events
    cm.display.wrapper.removeEventListener("cut", onCut, true);
  };

  CodeMirror.defineOption("minLines", undefined, function (cm, val, old) {
    if (val !== undefined && val > 0) start(cm);
    else end(cm);
  });
});

const defaultOptions = [
  {
    pageNumber: 0,
    fontIdx: 1,
    font: "arial.ttf",
    textReplacements: {
      foo: "bar",
    },
    removeObjects: ["/Image2", "/A"],
    plugins: [],
  },
];

window.addEventListener("DOMContentLoaded", () => {
  var textarea = $(".editor");
  window.editor = CodeMirror.fromTextArea(textarea, {
    theme: "dracula",
    mode: {
      name: "javascript",
      json: true,
      statementIndent: 2,
    },
    gutters: ["CodeMirror-lint-markers"],
    lint: true,
    autoRefresh: true,
    firstLineNumber: 1,
    lineNumbers: true,
    smartIndent: true,
    lineWrapping: true,
    indentWithTabs: true,
    refresh: true,
    minLines: 1,
    // matchBrackets: true,
    autoCloseBrackets: true,
    extraKeys: {
      "Ctrl-Q": function (cm) {
        cm.foldCode(cm.getCursor());
      },
    },
    foldGutter: true,
    gutters: ["CodeMirror-linenumbers", "CodeMirror-foldgutter"],
    foldOptions: {
      widget: (from, to) => {
        var count = undefined;

        // Get open / close token
        var startToken = "{",
          endToken = "}";
        var prevLine = window.editor.getLine(from.line);
        if (prevLine.lastIndexOf("[") > prevLine.lastIndexOf("{")) {
          (startToken = "["), (endToken = "]");
        }

        // Get json content
        var internal = window.editor.getRange(from, to);
        var toParse = startToken + internal + endToken;

        // Get key count
        try {
          var parsed = JSON.parse(toParse);
          count = Object.keys(parsed).length;
        } catch (e) {}

        return "\u2194"; // count ? `\u21A4${count}\u21A6` : "\u2194";
      },
    },
  });

  let lastVal;
  window.editor.on("change", (e, change) => {
    try {
      let editorVal = editor.getValue();
      let v = JSON.parse(editorVal);
      let val = JSON.stringify(v, null, 2);
      window.history.replaceState(
        null,
        "",
        `?options=${JSON.stringify(v).base64Encode()}`
      );
      if (
        editorVal != lastVal &&
        ((change.text.length > 0 &&
          change.text.some((c) => ["}", "]", '"'].includes(c))) ||
          change.origin === "paste")
      ) {
        lastVal = editorVal;
        let preCur = editor.getCursor();
        editor.setValue(val);
        editor.setCursor(preCur);
      }
    } catch (err) {}
  });

  try {
    let optionsFromUriText = window.location.search
      .replace(/^\?options\=/g, "")
      .base64Decode();
    let preCur = editor.getCursor();
    if (optionsFromUriText !== "") {
      let optionsFromUri = JSON.parse(optionsFromUriText);
      editor.setValue(JSON.stringify(optionsFromUri, null, 2));
      editor.setCursor(preCur);
    } else {
      editor.setValue(JSON.stringify(defaultOptions, null, 2));
    }
  } catch (e) {}
});
