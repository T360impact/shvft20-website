// Globals the portal's pages use that TypeScript doesn't know: the classic
// scripts loaded from /portal/vendor (pdf.js, JSZip).
interface Window {
  pdfjsLib: any;
  JSZip: any;
}
