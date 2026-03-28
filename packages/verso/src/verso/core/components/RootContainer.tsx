import React from 'react';
import { renderToString } from 'react-dom/server';
import { PAGE_ELEMENT_TOKEN_ID_ATTR } from '../../constants';

type RenderableHTMLAttributes = &
  Pick<
    React.HTMLAttributes<HTMLDivElement>,
    'id' | 'className' | 'style' | 'role' | 'hidden' | 'title' | 'lang' | 'dir' | 'tabIndex'
  > &
  React.AriaAttributes & {
  [key: `data-${string}`]: string | number | boolean | undefined;
};

export type RootContainerProps = RenderableHTMLAttributes & {
  children?: React.ReactNode;
}

export default function RootContainer(_: RootContainerProps): React.ReactNode {
  throw new Error('RootContainers cannot go inside non-RootContainers');
}

export type RootContainerElementType = React.ReactElement<RootContainerProps>;

const DIV_CLOSE = '</div>';

export function renderContainerOpen(element: RootContainerElementType, index: number): string {
  const { children, ...attrs } = element.props;
  const html = renderToString(<div {...{[PAGE_ELEMENT_TOKEN_ID_ATTR]: String(index)}} {...attrs} />);
  return html.slice(0, -(DIV_CLOSE.length)) + '\n';
}

export function renderContainerClose(): string {
  return `${DIV_CLOSE}\n`;
}
