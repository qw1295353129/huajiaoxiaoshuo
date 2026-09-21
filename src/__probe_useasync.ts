import { useAsync } from "@/app/hooks";

export function probeUseAsync(): void {
  const res = useAsync(() => Promise.resolve(1), [], 0);
  const [value, loading, error, reload] = res;
  reload();
  const intentionalError: string = 123;
  void value; void loading; void error; void intentionalError;
}
