import { type ReactNode } from "react";
import type {IsoStoreInstance} from "../../core";
import RootElement from "./RootElement";
import {IsoStoreProvider} from "../../provider";

// react-server projects could use something like this to wrap RootElement for use with isostores
interface Props {
  instances: IsoStoreInstance<any>[];
  children: ReactNode;
}
export function StoreRoot({ instances, children }: Props) {
  return (
    <RootElement when={Promise.all(instances.map(i => i.whenReady))}>
      <IsoStoreProvider instances={instances}>
        { children }
      </IsoStoreProvider>
    </RootElement>
  );
}
