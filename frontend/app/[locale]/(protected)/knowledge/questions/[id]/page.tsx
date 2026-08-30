"use client";

import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { Can } from "@/components/auth/Can";
import { QuestionStatusPill } from "@/components/knowledge/QuestionStatusPill";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Markdown } from "@/components/ui/Markdown";
import { MarkdownEditor } from "@/components/ui/MarkdownEditor";
import { ShareButton } from "@/components/ui/ShareButton";
import { Link } from "@/i18n/navigation";
import { formatRelativeTime } from "@/lib/datetime";
import { formatPersonName } from "@/lib/format";
import {
  acceptAnswer,
  closeQuestion,
  createAnswer,
  getQuestion,
  promoteQuestion,
  reopenQuestion,
} from "@/lib/api/knowledge";
import type { QuestionDetail } from "@/lib/api/types";
import { useAuth } from "@/lib/auth/AuthProvider";
import { useHasPermission } from "@/lib/auth/permissions";

export default function QuestionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations("knowledge.question");
  const { user } = useAuth();
  const canModerate = useHasPermission("question.moderate");
  const canCreateArticle = useHasPermission("article.create");

  const [question, setQuestion] = useState<QuestionDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [newAnswerBody, setNewAnswerBody] = useState("");
  const [isSubmittingAnswer, setIsSubmittingAnswer] = useState(false);
  const [workingAnswerId, setWorkingAnswerId] = useState<string | null>(null);
  const [isWorking, setIsWorking] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    getQuestion(id).then(setQuestion, () => setNotFound(true));
  }, [id]);

  if (notFound) {
    return <p className="font-body-md text-body-md text-error">{t("notFound")}</p>;
  }
  if (!question) {
    return <p className="font-body-md text-body-md text-on-surface-variant">{t("loading")}</p>;
  }

  const canManage = user?.id === question.author?.id || canModerate;
  const canAccept = canManage;
  const canPromote = canCreateArticle && question.status === "SOLVED" && !question.promoted_to_article;
  const authorName = formatPersonName(question.author);
  const questionId = `Q-${question.id.slice(0, 8).toUpperCase()}`;

  async function handleSubmitAnswer() {
    setIsSubmittingAnswer(true);
    setActionError(null);
    try {
      await createAnswer(question!.id, newAnswerBody);
      setNewAnswerBody("");
      setQuestion(await getQuestion(question!.id));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmittingAnswer(false);
    }
  }

  async function handleAccept(answerId: string, currentlyAccepted: boolean) {
    setWorkingAnswerId(answerId);
    setActionError(null);
    try {
      setQuestion(await acceptAnswer(question!.id, currentlyAccepted ? null : answerId));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setWorkingAnswerId(null);
    }
  }

  async function handleToggleClose() {
    setIsWorking(true);
    setActionError(null);
    try {
      setQuestion(question!.status === "CLOSED" ? await reopenQuestion(question!.id) : await closeQuestion(question!.id));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsWorking(false);
    }
  }

  async function handlePromote() {
    setIsWorking(true);
    setActionError(null);
    try {
      const article = await promoteQuestion(question!.id);
      setQuestion({ ...question!, promoted_to_article: article.id });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsWorking(false);
    }
  }

  return (
    <div className="max-w-[800px] mx-auto space-y-6">
      <div className="pb-4 border-b border-outline-variant space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 font-mono-sm text-mono-sm text-on-surface-variant">
            <Icon name="forum" size={16} />
            <span>{questionId}</span>
            <span>•</span>
            {authorName && <span>{t("askedBy", { name: authorName })}</span>}
            <span>•</span>
            <span>{formatRelativeTime(question.created_at)}</span>
          </div>
          <ShareButton title={question.title} />
        </div>
        <div className="flex items-center gap-3">
          <h1 className="font-headline-lg text-headline-lg text-on-surface">{question.title}</h1>
          <QuestionStatusPill status={question.status} />
        </div>
        <div className="flex flex-wrap gap-2">
          {question.tags.map((tag) => (
            <span
              key={tag.id}
              className="px-2.5 py-1 rounded-full bg-surface-container-low text-on-surface-variant font-label-caps text-label-caps uppercase border border-outline-variant"
            >
              {tag.name}
            </span>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canManage && (
            <Button variant="secondary" onClick={handleToggleClose} disabled={isWorking}>
              {question.status === "CLOSED" ? t("reopenButton") : t("closeButton")}
            </Button>
          )}
          {question.promoted_to_article && (
            <Link href={`/knowledge/articles/${question.promoted_to_article}`}>
              <Button variant="secondary">
                <Icon name="menu_book" size={16} />
                {t("viewPromotedArticle")}
              </Button>
            </Link>
          )}
        </div>
      </div>

      {actionError && (
        <p className="font-body-md text-body-md text-error" role="alert">
          {actionError}
        </p>
      )}

      <Markdown content={question.body} />

      {canPromote && (
        <div className="flex flex-wrap items-center justify-between gap-3 p-4 bg-primary-container/10 border border-primary/20 rounded-xl">
          <div className="flex items-center gap-3 text-primary font-body-md text-body-md">
            <Icon name="auto_awesome" size={20} className="shrink-0" />
            <span>{t("promoteBannerText")}</span>
          </div>
          <Button onClick={handlePromote} disabled={isWorking}>
            {t("promoteButton")}
          </Button>
        </div>
      )}

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
              const answerAuthorName = formatPersonName(answer.author);
              return (
                <div
                  key={answer.id}
                  className={`relative overflow-hidden rounded-xl bg-surface border p-6 ${
                    answer.is_accepted ? "border-secondary-fixed" : "border-outline-variant"
                  }`}
                >
                  {answer.is_accepted && <div className="absolute top-0 start-0 w-1 h-full bg-primary" />}
                  <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <Avatar person={answer.author} size="sm" />
                      <div>
                        {answerAuthorName && (
                          <div className="font-body-md text-body-md font-bold text-on-surface">{answerAuthorName}</div>
                        )}
                        <div className="font-mono-sm text-mono-sm text-on-surface-variant">
                          {answer.author?.title && <span>{answer.author.title} • </span>}
                          {formatRelativeTime(answer.created_at)}
                        </div>
                      </div>
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

      {question.status === "CLOSED" ? (
        <p className="font-body-md text-body-md text-on-surface-variant">{t("closedNotice")}</p>
      ) : (
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
      )}
    </div>
  );
}
