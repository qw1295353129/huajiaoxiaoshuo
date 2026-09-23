import { useNavigate } from "react-router-dom";
import { Button } from "@heroui/react";
import { FileQuestion } from "lucide-react";
import { ROUTES } from "@/app/routes";

export function NotFound() {
  const navigate = useNavigate();
  return (
    <div className="grid min-h-dvh place-items-center p-6">
      <div className="max-w-sm text-center">
        <FileQuestion className="mx-auto mb-4 size-10 opacity-30" />
        <h1 className="text-lg font-semibold">页面不存在</h1>
        <p className="mt-2 text-sm opacity-60">这个地址没有对应的页面，可能链接已经失效。</p>
        <Button className="mt-5" variant="primary" onPress={() => navigate(ROUTES.home)}>
          回到我的作品
        </Button>
      </div>
    </div>
  );
}
