import { formatScore } from "../../game/scoring";
import { useController } from "../context";
import { PixelText } from "./PixelText";

export function CourseComplete() {
  const c = useController();
  const f = c.final.value;
  return (
    <div class="overlay center-col card" data-testid="course-complete">
      <PixelText size="xl" tone="accent">
        COURSE COMPLETE
      </PixelText>
      {f?.scores.map((s, i) => (
        <PixelText key={i} size="l" tone={f.scores.length > 1 ? (i === 0 ? "p1" : "p2") : "normal"}>
          {f.scores.length > 1 ? `P${i + 1} ` : "TOTAL "}
          {formatScore(s)}
        </PixelText>
      ))}
    </div>
  );
}
