import React, {type ReactElement, type ReactNode} from 'react';

const ROOT_COMPONENT = Symbol('verso.RootComponent');

type WhenValue = object | null | undefined;
type When = Promise<WhenValue>;

export interface RootAPI {
  when?: When;
};

interface RootProps extends RootAPI {
  children: React.ReactNode;
}

type DeriveRootAPI<P> = (props: P) => RootAPI;

interface RootComponent<P> extends React.FC<P> {
  [ROOT_COMPONENT]: {
    deriveRootAPI: DeriveRootAPI<P>;
  };
}

export type RootElementType<P = object> = React.ReactElement<P> & { type: RootComponent<P> };

export function makeRootComponent<P extends object>(
  Component: React.FC<P>,
  deriveRootAPI: DeriveRootAPI<P> = (p) => p,
): RootComponent<P> {
  return Object.assign(
    (props: P) => <Component {...props} />,
    {[ROOT_COMPONENT]: { deriveRootAPI }},
  );
}

function isRootElement(element: ReactElement): element is RootElementType {
  return React.isValidElement(element) && typeof element.type === 'function' && ROOT_COMPONENT in element.type;
}

export function ensureRootElement(element: ReactElement): RootElementType {
  return isRootElement(element) ? element : <Root>{element}</Root> as RootElementType;
}

const Passthrough: React.FC<{ children: ReactNode }> = ({ children }) => children;

export const Root = makeRootComponent<RootProps>(Passthrough);

// --- scheduleRender: delay rendering until root is ready

export function scheduleRender(element: RootElementType){
  const { deriveRootAPI } = element.type[ROOT_COMPONENT];
  const { when } = deriveRootAPI(element.props);
  const ready = when ?? Promise.resolve();
  return ready.then((result) => {
    const props = {
      ...element.props,
      ...result,
    };
    return React.cloneElement(element, props);
  });
}
