import { Button } from "@heroui/react";
import { Construction } from "lucide-react";

/** 写作页占位：真实实现即将替换 */
export function EditorPage() {
  return (
    <div className="grid h-dvh place-items-center">
      <div className="text-center">
        <Construction className="mx-auto mb-4 size-9 opacity-25" />
        <p className="font-medium">写作台正在装配中</p>
        <p className="mt-2 max-w-sm text-sm opacity-60">即将上线：三栏写作界面、AI 续写与改写、版本快照、心流模式。</p>
        <Button className="mt-5" variant="ghost" onPress={() => history.back()}>
          返回
        </Button>
      </div>
    </div>
  );
}
