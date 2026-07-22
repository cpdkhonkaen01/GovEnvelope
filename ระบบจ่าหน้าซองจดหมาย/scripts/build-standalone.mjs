import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (path) => readFile(join(projectRoot, path), "utf8");
const readBinary = (path) => readFile(join(projectRoot, path));

const [template, css, config, app, brandLogo, garuda, sarabunFont] = await Promise.all([
  read("index.source.html"),
  read("assets/styles.css"),
  read("config.js"),
  read("assets/app.js"),
  readBinary("assets/brand-logo.jpg"),
  readBinary("assets/garuda.png"),
  readBinary("assets/fonts/THSarabunNew.ttf"),
]);

const stylesheetTag = '<link rel="stylesheet" href="assets/styles.css" />';
const scriptTags = '    <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.110.7/dist/umd/supabase.min.js"></script>\n    <script src="https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js"></script>\n    <script src="config.js"></script>\n    <script src="assets/app.js"></script>';
const brandLogoTag = '<img src="assets/brand-logo.jpg" alt="" />';
const garudaConfig = 'garudaImage: "assets/garuda.png"';

if (!template.includes(stylesheetTag) || !template.includes(scriptTags) || !template.includes(brandLogoTag)) {
  throw new Error("ไม่พบตำแหน่งไฟล์ CSS, JavaScript หรือโลโก้ใน index.source.html");
}
if (!config.includes(garudaConfig)) {
  throw new Error("ไม่พบตำแหน่งไฟล์ตราครุฑใน config.js");
}

const brandLogoDataUrl = `data:image/jpeg;base64,${brandLogo.toString("base64")}`;
const garudaDataUrl = `data:image/png;base64,${garuda.toString("base64")}`;
const sarabunFontDataUrl = `data:font/ttf;base64,${sarabunFont.toString("base64")}`;
const standaloneConfig = config.replace(garudaConfig, `garudaImage: "${garudaDataUrl}"`);
const standaloneCss = css.replace(/url\("fonts\/THSarabunNew\.ttf"\)/g, `url("${sarabunFontDataUrl}")`);
const standaloneApp = app.replace(/const PRINT_FONT_FILE = "assets\/fonts\/THSarabunNew\.ttf";/, `const PRINT_FONT_FILE = "${sarabunFontDataUrl}";`);

const output = template
  .replace(stylesheetTag, `<style id="app-styles">\n${standaloneCss}\n    </style>`)
  .replaceAll(brandLogoTag, `<img src="${brandLogoDataUrl}" alt="" />`)
  .replace(
    scriptTags,
    `    <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.110.7/dist/umd/supabase.min.js"></script>\n    <script src="https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js"></script>\n    <script id="app-config">\n${standaloneConfig}\n    </script>\n    <script id="app-script">\n${standaloneApp}\n    </script>`,
  );

await writeFile(join(projectRoot, "index.html"), output, "utf8");
console.log("สร้าง index.html แบบไฟล์เดียวสำเร็จ");
