import { Redirect } from "@/components/Redirect";

/** Old route, kept so shared links keep working. */
export default function Moved() {
  return <Redirect to="/app/protocol/token/" />;
}
