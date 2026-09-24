import { handleBookmarks } from "../server/x";

export function POST(request: Request) {
  return handleBookmarks(request);
}
