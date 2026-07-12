import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Interpretive Sculpture Pattern — VR Quest" },
      { name: "description", content: "Ένα διαδραστικό VR γλυπτό για τον Μέγα Βασίλειο: αναζήτησε την κρυμμένη επιγραφή, αποκάλυψε τη Βασιλειάδα και δες τη συλλογική μνήμη της τάξης να φωτίζει το γλυπτό." },
      { property: "og:title", content: "Interpretive Sculpture Pattern — VR Quest" },
      { property: "og:description", content: "VR quest για Μέγα Βασίλειο & Βασιλειάδα — τα λόγια των μαθητών ανάβουν το γλυπτό." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <iframe
      src="/game.html"
      title="Interpretive Sculpture Pattern VR"
      allow="xr-spatial-tracking; fullscreen; accelerometer; gyroscope"
      style={{
        position: "fixed",
        inset: 0,
        width: "100vw",
        height: "100vh",
        border: "none",
        background: "#0a0a0f",
      }}
    />
  );
}
