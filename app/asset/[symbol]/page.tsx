import { AssetPage } from "@/components/lumina/asset-page";

type PageProps = {
  params: {
    symbol: string;
  };
};

/**
 * Renders a live World Chain asset detail view.
 */
export default function Page({ params }: PageProps) {
  return <AssetPage symbol={params.symbol} />;
}
