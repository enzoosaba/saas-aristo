"use client";
import { Flame } from "lucide-react";
import { progress } from "@/lib/domain";
import Link from "next/link";
import Image from "next/image";
import ThemeToggle from "@/components/ThemeToggle";
import QuickAdd from "@/components/QuickAdd";
import Avatar from "@/components/ui/Avatar";
import MobileMoreMenu from "@/components/MobileMoreMenu";

import { useStudy } from "./StudyProvider";
export default function TopBar() {
  const { data } = useStudy();
  const stats = progress(data.items, data.records, data.today);
  return (
    <header className="site-header">
      <div className="header-inner">
        <Link
          href="/"
          className="header-brand"
          aria-label="Coelho Mentoria, início"
        >
          <Image
            src="/brand/coelho.png"
            alt=""
            width={43}
            height={48}
            className="brand-rabbit"
            priority
          />
          <span>
            coelho<small>MENTORIA</small>
          </span>
        </Link>
        <div className="header-progress" aria-label="Seu progresso">
          <strong className="streak-with-fire">
            <Flame size={18} aria-hidden="true" />
            {stats.streak} dias
          </strong>
          <span>{stats.xp} XP</span>
        </div>
        <div className="header-actions">
          <MobileMoreMenu />
          <Link
            href="/perfil"
            className="header-account"
            aria-label={`${data.user.name}, Meu perfil`}
          >
            <Avatar user={data.user} />
            <span>
              {data.user.name}
              <small>Meu perfil</small>
            </span>
          </Link>
          <ThemeToggle />
          <QuickAdd />
        </div>
      </div>
    </header>
  );
}
