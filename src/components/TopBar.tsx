"use client";
import Link from "next/link";
import Image from "next/image";
import ThemeToggle from "@/components/ThemeToggle";
import QuickAdd from "@/components/QuickAdd";

import {useStudy} from "./StudyProvider";
export default function TopBar() {
 const {data}=useStudy();
  return <header className="site-header">
    <div className="header-inner">
      <Link href="/" className="header-brand" aria-label="Mentoria Coelho, início">
        <Image src="/brand/coelho.png" alt="" width={43} height={48} className="brand-rabbit" priority />
        <span>coelho<small>MENTORIA</small></span>
      </Link>
      <div className="header-actions"><Link href="/perfil" className="header-account" aria-label="Abrir meu perfil">
        <span className="avatar">{data.user.name.split(" ").map(n=>n[0]).slice(0,2).join("")}</span><span>{data.user.name}<small>Meu perfil</small></span>
      </Link><ThemeToggle/><QuickAdd/></div>
    </div>
  </header>;
}
