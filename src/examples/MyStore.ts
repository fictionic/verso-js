import {defineStore} from "..";

interface MyOpts {
  userId: number;
}
interface MyState {
  name: string;
  setName: (name: string) => void;
}
export default defineStore<MyOpts, MyState>(({ userId }, set, get, waitFor) => {
  return {
    ...waitFor('name', new Promise<string>((resolve) => {
      // imagine this depended on userId
      setTimeout(() => resolve("bob"), 100);
    }), ''),
    setName: (name: string) => {
      set({
        name,
      });
    },
  };
});
