"use client";

import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { Can } from "@/components/auth/Can";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Markdown } from "@/components/ui/Markdown";
import { MarkdownEditor } from "@/components/ui/MarkdownEditor";
import { formatRelativeTime } from "@/lib/datetime";
import { acceptAnswer, createAnswer, getQuestion } from "@/lib/api/knowledge";
import type { QuestionDetail } from "@/lib/api/types";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useHasPermission } from "@/lib/auth/permissions";

export default function QuestionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations("knowledge.question");
  const { user } = useAuth();
  const canModerate = useHasPermission("question.moderate");

  const [question, setQuestion] = useState<QuestionDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [newAnswerBody, setNewAnswerBody] = useState("");
  const [isSubmittingAnswer, setIsSubmittingAnswer] = useState(false);
  const [workingAnswerId, setWorkingAnswerId] = useState<string | null>(null);

  useEffect(() => {
    getQuestion(id).then(setQuestion, () => setNotFound(true));
  }, [id]);

  if (notFound) {
    return <p className="font-body-md text-body-md text-error">{t("notFound")}</p>;
  }
  if (!question) {
    return <p className="font-body-md text-body-md text-on-surface-variant">{t("loading")}</p>;
  }

  const canAccept = user?.id === question.author?.id || canModerate;
  const authorName = question.author
    ? [question.author.first_name, question.author.last_name].filter(Boolean).join(" ") || question.author.email
    : null;

  async function handleSubmitAnswer() {
    setIsSubmittingAnswer(true);
    try {
      await createAnswer(question!.id, newAnswerBody);
      setNewAnswerBody("");
      setQuestion(await getQuestion(question!.id));
    } finally {
      setIsSubmittingAnswer(false);
    }
  }

  async function handleAccept(answerId: string, currentlyAccepted: boolean) {
    setWorkingAnswerId(answerId);
    try {
      setQuestion(await acceptAnswer(question!.id, currentlyAccepted ? null : answerId));
    } finally {
      setWorkingAnswerId(null);
    }
  }

  return (
    <div className="max-w-[800px] mx-auto space-y-6">
      <div className="pb-4 border-b border-outline-variant space-y-3">
        <div className="flex items-center gap-2 font-mono-sm text-mono-sm text-on-surface-variant">
          <Icon name="forum" size={16} />
          {authorName && <span>{t("askedBy", { name: authorName })}</span>}
          <span>•</span>
          <span>{formatRelativeTime(question.created_at)}</span>
        </div>
        <h1 className="font-headline-lg text-headline-lg text-on-surface">{question.title}</h1>
        <div className="flex flex-wrap gap-2">
          {question.tags.map((tag) => (
            <span
              key={tag.id}
              className="font-mono-sm text-mono-sm text-on-surface-variant border border-outline-variant rounded-full px-3 py-1"
            >
              #{tag.name}
            </span>
          ))}
        </div>
      </div>

      <Markdown content={question.body} />

      <div>
        <h2 className="flex items-center gap-2 font-headline-md text-headline-md text-on-surface mb-4">
          <Icon name="forum" size={18} />
          {t("answersHeading", { count: question.answers.length })}
        </h2>

        {question.answers.length === 0 ? (
          <p className="font-body-md text-body-md text-on-surface-variant">{t("noAnswersYet")}</p>
        ) : (
          <div className="space-y-4">
            {question.answers.map((answer) => {
              const answerAuthorName = answer.author
                ? [answer.author.first_name, answer.author.last_name].filter(Boolean).join(" ") ||
                  answer.author.email
                : null;
              return (
                <div
                  key={answer.id}
                  className={`relative overflow-hidden rounded-xl bg-surface border p-6 ${
                    answer.is_accepted ? "border-secondary-fixed" : "border-outline-variant"
                  }`}
                >
                  {answer.is_accepted && <div className="absolute top-0 start-0 w-1 h-full bg-primary" />}
                  <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
                    <div className="flex items-center gap-2 font-body-md text-body-md">
                      {answerAuthorName && <span className="font-bold text-on-surface">{answerAuthorName}</span>}
                      <span className="font-mono-sm text-mono-sm text-on-surface-variant">
                        {formatRelativeTime(answer.created_at)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {answer.is_accepted && (
                        <span className="flex items-center gap-1 text-primary bg-primary-fixed/30 px-2.5 py-1 rounded-full font-label-caps text-label-caps uppercase">
                          <Icon name="check_circle" size={14} />
                          {t("acceptedAnswerBadge")}
                        </span>
                      )}
                      {canAccept && (
                        <Button
                          variant="secondary"
                          onClick={() => handleAccept(answer.id, answer.is_accepted)}
                          disabled={workingAnswerId === answer.id}
                        >
                          {answer.is_accepted ? t("unacceptButton") : t("acceptButton")}
                        </Button>
                      )}
                    </div>
                  </div>
                  <Markdown content={answer.body} />
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Can permission="question.answer">
        <div className="space-y-3">
          <h3 className="font-headline-md text-headline-md text-on-surface">{t("addAnswerHeading")}</h3>
          <MarkdownEditor
            value={newAnswerBody}
            onChange={setNewAnswerBody}
            placeholder={t("answerComposerPlaceholder")}
          />
          <Button onClick={handleSubmitAnswer} disabled={isSubmittingAnswer || !newAnswerBody.trim()}>
            <Icon name="send" size={16} />
            {t("submitAnswer")}
          </Button>
        </div>
      </Can>
    </div>
  );
}
