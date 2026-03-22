import type {ReactElement} from 'react';
import {defineResponder, type BaseChainedMethods, type BaseHookMethods, type ResponderFns} from './Responder';

export type Stylesheet = { href: string } | { text: string; type?: string; media?: string };

export interface PageChainedMethods {
  getTitle(): string;
  getHeadStylesheets(): Stylesheet[];
  getElements(): ReactElement[];
}

export interface PageMethods extends Partial<BaseHookMethods>, BaseChainedMethods, PageChainedMethods {};

export type PageInit = (opts: ResponderFns) => PageMethods;

export interface PageDefinition {
  type: 'page';
  init: PageInit;
};

export function definePage(init: PageInit): PageDefinition {
  return defineResponder('page', init);
};
