import { handleBookmarks } from "../server/x.js";

export function POST(request: Request) {
  return handleBookmarks(request);
}
