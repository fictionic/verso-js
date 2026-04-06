import {PAGE_HEADER_SCRIPT_ELEMENT_ATTR} from "../core/constants";
import {getScriptAttrs, setNodeAttrs, type Script} from "../core/handler/Page";
import {normalizeUrl} from "./url";

export interface ScriptTransitioner {
  readServerScripts: () => void;
  transitionScripts: (newScripts: Script[]) => void;
}

export const getScriptTransitioner = (): ScriptTransitioner => {
  const loaded = new Set<string>();

  function keyFor(script: Script): string {
    const scriptType = script.type ?? '';
    const scriptContent = 'src' in script ?
      'src|' + normalizeUrl(script.src) :
      'text|' + script.content;
    return `type:${scriptType}|${scriptContent}`;
  }

  function keyForNode(node: HTMLScriptElement): string {
    const script = {
      type: node.type,
      ...(!!node.src ? {
        src: node.src,
      } : {
        content: node.innerHTML,
      }),
    };
    return keyFor(script);
  }

  return {
    readServerScripts: () => {
      document.querySelectorAll<HTMLScriptElement>(`script[${PAGE_HEADER_SCRIPT_ELEMENT_ATTR}]`).forEach((node) => {
        loaded.add(keyForNode(node));
      });
    },

    transitionScripts: (newScripts: Script[]) => {
      newScripts.forEach((script) => {
        const key = keyFor(script);
        if (!loaded.has(key)) {
          const node = createScriptNode(script);
          document.head.appendChild(node);
          loaded.add(key);
        }
      });
    },
  };
};

function createScriptNode(script: Script): HTMLScriptElement {
  const node = document.createElement('script');
  setNodeAttrs(node, getScriptAttrs(script));
  if ('content' in script) {
    node.innerHTML = script.content;
  }
  return node;
}
