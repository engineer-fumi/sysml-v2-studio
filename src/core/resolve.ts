import { SysMLElement } from "./ast";

/**
 * Approximate name resolution for the SysML v2 subset.
 *
 * Resolves qualified names (`A::B`) and feature chains (`a.b.c`) by walking
 * the scope chain (local members -> inherited members via typing /
 * specialization -> imports -> ancestors -> global packages). This is a
 * pragmatic approximation of the KerML name resolution rules: visibility
 * (private/protected) is not enforced.
 */
export class Resolver {
  /** scopes currently having their imports resolved (cycle guard) */
  private importStack = new Set<SysMLElement>();
  private importCache = new Map<
    SysMLElement,
    { star: boolean; isPublic: boolean; target: SysMLElement }[]
  >();

  constructor(private root: SysMLElement) {}

  /**
   * Resolve a (possibly dotted / qualified) reference from a scope.
   * `exclude` skips one element in the first-segment lookup — reference
   * usages such as `perform x` carry the target as their own name and must
   * not resolve to themselves.
   */
  resolve(scope: SysMLElement, path: string, exclude?: SysMLElement): SysMLElement | undefined {
    // conjugated references (~Port) resolve to the original type
    const segments = path.replace(/^~/, "").split(/::|\./).filter(Boolean);
    if (!segments.length) return undefined;
    if (segments[0] === "*" || segments[0] === "**") return undefined;

    let cur = this.lookupInScopes(scope, segments[0], exclude);
    if (!cur) return undefined;
    for (let i = 1; i < segments.length; i++) {
      const seg = segments[i];
      if (seg === "*" || seg === "**") return cur; // import wildcard – resolved enough
      const next = this.lookupMember(cur, seg, new Set(), exclude);
      if (!next) return undefined;
      cur = next;
    }
    return cur;
  }

  /** First segment: walk the scope chain upwards. */
  private lookupInScopes(
    scope: SysMLElement,
    name: string,
    exclude?: SysMLElement
  ): SysMLElement | undefined {
    for (let s: SysMLElement | undefined = scope; s; s = s.parent) {
      // own + inherited members of this scope
      const m = this.lookupMember(s, name, new Set(), exclude);
      if (m) return m;
      // imports declared in this scope
      for (const imp of this.importsOf(s)) {
        if (imp.star) {
          const viaStar = this.lookupExported(imp.target, name, new Set(), exclude);
          if (viaStar) return viaStar;
        } else if (imp.target.name === name || imp.target.shortName === name) {
          return imp.target;
        }
      }
    }
    // global: top-level members of every file (incl. the standard library)
    for (const file of this.root.children) {
      const m = this.lookupLocal(file, name, exclude);
      if (m) return m;
    }
    return undefined;
  }

  /**
   * Member of a namespace as visible from outside: direct members plus
   * anything re-exported through its `public import` chain (transitive,
   * cycle-guarded). Private imports are not re-exported.
   */
  private lookupExported(
    ns: SysMLElement,
    name: string,
    seen: Set<SysMLElement>,
    exclude?: SysMLElement
  ): SysMLElement | undefined {
    if (seen.has(ns)) return undefined;
    seen.add(ns);
    const direct = this.lookupLocal(ns, name, exclude);
    if (direct) return direct;
    for (const imp of this.importsOf(ns)) {
      if (!imp.isPublic) continue;
      if (imp.star) {
        const m = this.lookupExported(imp.target, name, seen, exclude);
        if (m) return m;
      } else if (imp.target.name === name || imp.target.shortName === name) {
        return imp.target;
      }
    }
    return undefined;
  }

  /** Direct child of `scope` named `name` (following aliases). */
  private lookupLocal(
    scope: SysMLElement,
    name: string,
    exclude?: SysMLElement
  ): SysMLElement | undefined {
    for (const c of scope.children) {
      if (c === exclude) continue;
      if (c.name === name || c.shortName === name) {
        if (c.kind === "alias" && c.target) {
          return this.resolve(scope, c.target) ?? c;
        }
        return c;
      }
    }
    return undefined;
  }

  /** Member lookup including inherited members (typedBy / specializes). */
  lookupMember(
    el: SysMLElement,
    name: string,
    seen: Set<SysMLElement>,
    exclude?: SysMLElement
  ): SysMLElement | undefined {
    if (seen.has(el)) return undefined;
    seen.add(el);
    const direct = this.lookupLocal(el, name, exclude);
    if (direct) return direct;
    for (const g of this.generalsOf(el, seen)) {
      const m = this.lookupMember(g, name, seen, exclude);
      if (m) return m;
    }
    return undefined;
  }

  /** Types / supertypes of an element, resolved from its declaration scope. */
  generalsOf(el: SysMLElement, seen: Set<SysMLElement>): SysMLElement[] {
    const out: SysMLElement[] = [];
    const scope = el.parent ?? this.root;
    for (const t of [...el.typedBy, ...el.specializes, ...el.redefines]) {
      const r = this.resolveGuarded(scope, t, seen);
      if (r && r !== el) out.push(r);
    }
    return out;
  }

  /** resolve() that propagates the cycle guard into the first segment. */
  private resolveGuarded(
    scope: SysMLElement,
    path: string,
    seen: Set<SysMLElement>
  ): SysMLElement | undefined {
    const segments = path.replace(/^~/, "").split(/::|\./).filter(Boolean);
    if (!segments.length) return undefined;
    let cur: SysMLElement | undefined;
    for (let s: SysMLElement | undefined = scope; s && !cur; s = s.parent) {
      if (seen.has(s)) continue;
      cur = this.lookupLocal(s, segments[0]);
      if (!cur) {
        for (const imp of this.importsOf(s)) {
          if (imp.star) {
            cur = this.lookupExported(imp.target, segments[0], new Set());
          } else if (imp.target.name === segments[0] || imp.target.shortName === segments[0]) {
            cur = imp.target;
          }
          if (cur) break;
        }
      }
    }
    if (!cur) {
      for (const file of this.root.children) {
        cur = this.lookupLocal(file, segments[0]);
        if (cur) break;
      }
    }
    if (!cur) return undefined;
    for (let i = 1; i < segments.length && cur; i++) {
      cur = this.lookupMember(cur, segments[i], new Set(seen));
    }
    return cur;
  }

  /** Imports declared directly in a scope, resolved (cached, cycle-guarded). */
  private importsOf(
    scope: SysMLElement
  ): { star: boolean; isPublic: boolean; target: SysMLElement }[] {
    const cached = this.importCache.get(scope);
    if (cached) return cached;
    if (this.importStack.has(scope)) return [];
    this.importStack.add(scope);
    const out: { star: boolean; isPublic: boolean; target: SysMLElement }[] = [];
    try {
      for (const c of scope.children) {
        if (c.kind !== "import" || !c.target) continue;
        const star = /::\*\*?$/.test(c.target) || c.target.endsWith("*");
        const isPublic = !c.modifiers.includes("private") && !c.modifiers.includes("protected");
        const base = c.target.replace(/(::)?\*\*?$/, "");
        if (!base) continue;
        // import targets resolve from the importing scope itself so sibling /
        // child packages work (`package P { import Defs::*; package Defs {} }`);
        // the importStack guard prevents self-recursion through this scope
        const target = this.resolve(scope, base);
        if (target) out.push({ star, isPublic, target });
      }
    } finally {
      this.importStack.delete(scope);
    }
    this.importCache.set(scope, out);
    return out;
  }
}
