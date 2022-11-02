import { Uppy, Dashboard, XHRUpload } from "./uppy.min.mjs";

var uppy = new Uppy({
  restrictions: {
    maxFileSize: 5000000,
    maxNumberOfFiles: 70,
    minNumberOfFiles: 1,
    allowedFileTypes: ["application/pdf"],
  },
  formData: true,
})
  .use(Dashboard, {
    inline: true,
    target: "#drag-drop-area",
    theme: "dark",
    replaceTargetContent: true,
    showProgressDetails: true,
    note: "PDF only, 1-30 files, up to 5 MBs",
    height: 470,
    metaFields: [
      { id: "name", name: "Name", placeholder: "file name" },
      {
        id: "caption",
        name: "Caption",
        placeholder: "describe what the pdf is about",
      },
    ],
    browserBackButtonClose: true,
  })
  .use(XHRUpload, { endpoint: "/pdf/proc" });

uppy.on("upload-success", (t, res) => {
  if (res?.body?.success) {
    for (let stat of res.body.data) {
      window.contentMgr.add(stat.name, stat.url);
    }
  }
});

uppy.on("upload-error", (t, err, res) => {
  iziToast.error({
    title: "UploadErr",
    message: `[${res.status || 200}] ${err.message}`,
  });
});

uppy.on("complete", (result) => {
  iziToast.success({ title: "Done!", message: "finished uploading." });
});
