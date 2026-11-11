import Image from "next/image";

export default function Home() {
  return (
    <div className="flex flex-col flex-1 items-center justify-center font-sans">
      <main className="flex flex-1 w-full max-w-3xl flex-col items-center justify-between py-32 px-16 bg-white">
        <h1 className="text-6xl font-bold text-black sm:text-5xl">
          Store Chain Simulator
        </h1>
      </main>
    </div>
  );
}
