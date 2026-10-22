export type InterviewInput = {
  role: string;
  jd: string;
  resume: string;
  filename: string;
  duration: string;
  assistant: string;
};

export type InterviewQuestion = {
  category: string;
  title: string;
  basis: string;
  sample: string;
};

export type InterviewSession = InterviewInput & {
  preparation?: {
    taskId: string;
    inputVersion: number;
    bundle: import("./api").Bundle;
  };
  id: string;
  createdAt: string;
  project: string;
  focus: string[];
  questions: InterviewQuestion[];
};

export type InterviewAnswer = {
  question: string;
  category: string;
  text: string;
  at: number;
};

export type InterviewFeedback = InterviewAnswer & {
  index: number;
  title: string;
  detail: string;
  excerpt: string;
};

export type Devices = { mic: boolean; camera: boolean };
export type InterviewStage =
  "materials" | "preparation" | "interview" | "evaluating" | "review";
export type JobStatus = "loading" | "ready" | "failed";
export type NavigationGuard = (continueNavigation: () => void) => boolean;
export type RegisterNavigationGuard = (guard: NavigationGuard | null) => void;

export type InterviewState = {
  form: InterviewInput;
  touched: boolean;
  session: InterviewSession | null;
  stage: InterviewStage;
  jobStep: number;
  jobStatus: JobStatus;
  attempt: number;
  index: number;
  answers: InterviewAnswer[];
  draft: string;
  seconds: number;
  paused: boolean;
  devices: Devices;
};
