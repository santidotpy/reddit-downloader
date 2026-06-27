import { Downloader } from "@/components/downloader";

export default function Page() {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-4xl flex-col gap-10 px-4 py-12 sm:py-16">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Reddit Downloader
        </h1>
        <p className="text-sm text-muted-foreground sm:text-base">
          Pegá una o varias URLs de Reddit y descargá imágenes, galerías y videos
          con audio.
        </p>
      </header>
      <Downloader />
    </main>
  );
}
