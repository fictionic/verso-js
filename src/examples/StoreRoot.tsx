import {  type ReactNode } from "react";
import type {StoreInstance, StoreProvider} from "..";
import RootElement from "./RootElement";

interface Props<State> {
  instance: StoreInstance<State>
  StoreProvider: StoreProvider<State>;
  children: ReactNode;
}
export function StoreRoot<State>({
  instance,
  StoreProvider,
  children,
}: Props<State>) {
  return (
    <RootElement when={() => instance.ready}>
      <StoreProvider instance={instance}>
        { children }
      </StoreProvider>
    </RootElement>
  );
}
