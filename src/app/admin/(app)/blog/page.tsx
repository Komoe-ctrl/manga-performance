import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/shared";
import { AdminBlogList } from "@/components/marketing/blog-list";

export default function Page() {
  return (
    <>
      <PageHeader
        title="Blog"
        description="Articles publiés et brouillons."
        actions={<Link href="/admin/blog/nouveau" className={buttonVariants({ variant: "accent" })}>Nouvel article</Link>}
      />
      <AdminBlogList />
    </>
  );
}
