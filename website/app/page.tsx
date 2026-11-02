import { Nav } from "@/components/Nav";
import { RevealObserver } from "@/components/Reveal";
import { Hero } from "@/components/sections/Hero";
import { Problem } from "@/components/sections/Problem";
import { Solution } from "@/components/sections/Solution";
import { Features } from "@/components/sections/Features";
import { Showcase } from "@/components/sections/Showcase";
import { Origin } from "@/components/sections/Origin";
import { SelfHost } from "@/components/sections/SelfHost";
import { Footer } from "@/components/sections/Footer";
import { links, site } from "@/content/site";

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Athar",
  alternateName: "أثر",
  description: site.description,
  applicationCategory: "BusinessApplication",
  operatingSystem: "Linux, Docker",
  license: "https://www.apache.org/licenses/LICENSE-2.0",
  codeRepository: links.repo,
  url: site.url,
  isAccessibleForFree: true,
  author: { "@type": "Organization", name: "Lycans AeroDesign", url: links.lycansSite },
};

export default function Home() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <Nav />
      <main id="main">
        <Hero />
        <Problem />
        <Solution />
        <Features />
        <Showcase />
        <Origin />
        <SelfHost />
      </main>
      <Footer />
      <RevealObserver />
    </>
  );
}
