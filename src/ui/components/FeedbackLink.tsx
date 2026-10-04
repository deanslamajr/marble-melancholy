import { FEEDBACK_URL } from "../../version";

export function FeedbackLink() {
  if (!FEEDBACK_URL) return null;
  return (
    <a
      class="feedback-link"
      href={FEEDBACK_URL}
      target="_blank"
      rel="noopener noreferrer"
      data-testid="feedback-link"
    >
      FEEDBACK ↗
    </a>
  );
}
