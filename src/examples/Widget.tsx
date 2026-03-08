import MyStore from './MyStore';

export default function Widget() {
  const name = MyStore.useStore((state) => state.name);
  const MyClientStore = MyStore.useCreateClientStore({ userId: 2 });
  const name2 = MyClientStore.useClientStore((state) => state.name);
  return (
    <div>
      { name }
    </div>
  );
}



