import { Inter } from "next/font/google";

Inter({ subsets: ["latin"], weight: ["400", "500", "600"], display: "swap" });

// Font side effects happen at module scope.
export default function Head() {
  return null;
}
