export interface SafeErrorVNext {
  category: "provider" | "validation" | "forbidden_field" | "orchestration";
  code: string;
  stage: "geometry" | "evidence" | "provider" | "orchestration";
  message: string;
  status: number | null;
  requestId: string | null;
}

export function safeErrorVNext(params: SafeErrorVNext): SafeErrorVNext {
  return { ...params };
}
