import { indexHTML } from "./assets/index";
import { mainJS } from "./assets/main";
import { stylesCSS } from "./assets/styles";

export function getMiniAppAsset(
  path: string,
  botName: string,
  botKind: string,
  configJson: string,
): { content: string; contentType: string } {
  if (path.endsWith("main.js")) {
    return {
      content: mainJS
        .replace("||botName||", botName)
        .replace("||botKind||", botKind)
        .replace("||configJson||", configJson),
      contentType: "application/javascript",
    };
  }
  if (path.endsWith("styles.css")) {
    return { content: stylesCSS, contentType: "text/css" };
  }
  return {
    content: indexHTML.replace("||botName||", botName),
    contentType: "text/html",
  };
}
