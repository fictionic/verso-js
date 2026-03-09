import {defineZustandIsoStore} from "../adapters/zustand";

interface MyOpts {
  userId: number;
}
interface MyState {
  name: string;
  note: string;
  setName: (name: string) => void;
}
type MyMessage = string;
export default defineZustandIsoStore<MyOpts, MyState, MyMessage>(
  ({ userId }, waitFor, onMessage) => (
    (set, get) => ({
      ...onMessage((message: string) => {
        set({ note: message });
      }),
      note: '',
      ...waitFor('name', new Promise<string>((resolve) => {
        // imagine this depended on userId
        setTimeout(() => resolve("bob"), 100);
      }), ''),
      setName: (name: string) => {
        set({
          name,
        });
      },
    })
  )
);
