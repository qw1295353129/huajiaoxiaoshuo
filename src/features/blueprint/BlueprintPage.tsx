import { useParams } from "react-router-dom";
import { PageScaffold } from "@/components/common/PageScaffold";
import { BlueprintPanel } from "./BlueprintPanel";

/**
 * 拆书 / 仿书页。
 *
 * 定位说明写在页面描述里，让作者第一眼就知道这个功能在做什么、
 * 以及它和「一句话成书」的区别：那个是从零开始造，这个是先学一本再写。
 */
export function BlueprintPage() {
  const { projectId = "" } = useParams<{ projectId: string }>();

  return (
    <PageScaffold
      title="拆书仿写"
      description="拆一本写得好的书，学它的技法与结构，用它来写你自己的故事"
      withNav
    >
      <div className="mx-auto max-w-4xl">
        <BlueprintPanel projectId={projectId} />
      </div>
    </PageScaffold>
  );
}
